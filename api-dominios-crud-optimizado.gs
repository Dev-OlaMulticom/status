/**
 * ============================================================
 *  API DE GESTÃO DE DOMÍNIOS — Google Apps Script + Sheets
 *  VERSIÓN OPTIMIZADA
 * ============================================================
 *
 *  Objetivo de esta versión: minimizar llamadas a Sheets/Cache
 *  en cada request, para no agotar tiempo de ejecución ni cuota.
 *
 *  Estrategias clave:
 *   1. Índice { id -> número de fila } cacheado, construido leyendo
 *      SOLO la columna "id" (no toda la hoja). update/delete usan
 *      este índice para ir directo a la fila exacta.
 *   2. update() lee y escribe SOLO la fila afectada, no toda la hoja.
 *   3. La caché de datos (usada por list/get) se SINCRONIZA en
 *      memoria tras cada escritura, en vez de borrarse por completo
 *      -> evita relecturas completas innecesarias.
 *   4. Headers cacheados aparte con TTL largo (cambian casi nunca).
 *   5. Endpoint "bulkUpdate": N actualizaciones en 1 sola petición
 *      y 1 solo lock, en vez de N peticiones HTTP separadas.
 * ============================================================
 */


/** ===================== CONFIGURACIÓN ===================== **/

const API_KEY = PropertiesService.getScriptProperties().getProperty('API_KEY') || 'CAMBIA_ESTA_KEY';
const TABLE = 'dominios';

// TTLs de caché (en segundos)
const DATA_TTL = 20;        // caché de filas (list/get) - datos cambian seguido
const INDEX_TTL = 20;       // caché del índice id -> fila
const HEADERS_TTL = 21600;  // caché de headers - 6 horas, casi nunca cambian

// Claves de caché
const DATA_CACHE_KEY = 'tbl_' + TABLE;
const INDEX_CACHE_KEY = 'idx_' + TABLE;
const HEADERS_CACHE_KEY = 'hdr_' + TABLE;


/** ============================================================
 *  PUNTOS DE ENTRADA
 * ============================================================ **/

/**
 * doGet — Operaciones de LECTURA (READ).
 *   ?action=list  -> lista con filtros opcionales
 *   ?action=get   -> un registro por id
 */
function doGet(e) {
  try {
    checkAuth(e.parameter.key);
    const action = e.parameter.action || 'list';

    let result;
    switch (action) {
      case 'list':
        result = listRows(e.parameter);
        break;
      case 'get':
        if (!e.parameter.id) throw new Error('Falta "id"');
        result = getRow(e.parameter.id);
        break;
      default:
        throw new Error('Acción GET no soportada: ' + action);
    }
    return jsonResponse({ ok: true, data: result });
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


/**
 * doPost — Operaciones de ESCRITURA (CREATE / UPDATE / DELETE / BULK).
 */
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    checkAuth(body.key);

    const { action, id, data, items } = body;
    let result;

    // Un solo lock para toda la operación (incluye bulk: N cambios,
    // 1 sola espera de lock en vez de N).
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);

    try {
      switch (action) {

        case 'create':
          result = createRow(data);
          break;

        case 'update':
          if (!id) throw new Error('Falta "id"');
          result = updateRow(id, data);
          break;

        case 'comment':
          if (!id) throw new Error('Falta "id"');
          result = updateRow(id, { comentarios: data.comentarios });
          break;

        case 'delete':
          if (!id) throw new Error('Falta "id"');
          result = deleteRow(id);
          break;

        case 'bulkUpdate':
          // items: [{ id, data }, { id, data }, ...]
          if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Falta "items" (array de { id, data })');
          }
          result = bulkUpdateRows(items);
          break;

        default:
          throw new Error('Acción POST no soportada: ' + action);
      }
    } finally {
      lock.releaseLock();
    }

    return jsonResponse({ ok: true, data: result });

  } catch (err) {
    return jsonResponse({ ok: false, error: err.message });
  }
}


/** ============================================================
 *  CACHÉ: HEADERS
 * ============================================================ **/

/**
 * Devuelve los headers (fila 1) desde caché si están disponibles.
 * TTL largo porque la estructura de columnas casi nunca cambia.
 */
function getHeaders(sheet) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(HEADERS_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h).trim());
  safeCachePut(HEADERS_CACHE_KEY, JSON.stringify(headers), HEADERS_TTL);
  return headers;
}


/** ============================================================
 *  CACHÉ: ÍNDICE DE IDs (id -> número de fila real en la hoja)
 * ============================================================ **/

/**
 * Construye (o recupera de caché) el índice { id: numeroDeFila }.
 * CLAVE: lee SOLO la columna "id" con getRange(fila, col, cantidad, 1),
 * no toda la hoja. Con 151 filas eso es ~151 celdas en vez de
 * 151 x N-columnas.
 */
function getIdIndex(sheet, headers) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(INDEX_CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const idCol = headers.indexOf('id');
  if (idCol === -1) throw new Error('La hoja no tiene columna "id"');

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  const idValues = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();

  const index = {};
  idValues.forEach((row, i) => {
    const id = row[0];
    if (id) index[id] = i + 2; // +2: la fila 1 es header, y el array es 0-index
  });

  safeCachePut(INDEX_CACHE_KEY, JSON.stringify(index), INDEX_TTL);
  return index;
}

/** Agrega/actualiza UNA entrada del índice sin reconstruirlo entero. */
function setIndexEntry(id, rowNumber) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(INDEX_CACHE_KEY);
  const index = cached ? JSON.parse(cached) : {};
  index[id] = rowNumber;
  safeCachePut(INDEX_CACHE_KEY, JSON.stringify(index), INDEX_TTL);
}

/** Invalida el índice completo (necesario tras un delete, porque
 *  las filas posteriores a la borrada se recorren una posición). */
function invalidateIndex() {
  CacheService.getScriptCache().remove(INDEX_CACHE_KEY);
}


/** ============================================================
 *  CACHÉ: DATOS (usada por list/get)
 * ============================================================ **/

function getDataCache() {
  const cached = CacheService.getScriptCache().get(DATA_CACHE_KEY);
  return cached ? JSON.parse(cached) : null;
}

function putDataCache(payload) {
  safeCachePut(DATA_CACHE_KEY, JSON.stringify(payload), DATA_TTL);
}

function invalidateDataCache() {
  CacheService.getScriptCache().remove(DATA_CACHE_KEY);
}

/** Agrega un registro nuevo a la caché de datos YA existente,
 *  en vez de invalidarla entera (evita una relectura completa
 *  de la hoja en el próximo list/get). Si no había caché activa,
 *  no hace nada: se reconstruirá sola en la próxima lectura. */
function appendToDataCache(record) {
  const cached = getDataCache();
  if (!cached) return;
  cached.rows.push(record);
  putDataCache(cached);
}

/** Reemplaza un registro existente dentro de la caché de datos. */
function replaceInDataCache(record) {
  const cached = getDataCache();
  if (!cached) return;
  const idx = cached.rows.findIndex(r => String(r.id) === String(record.id));
  if (idx !== -1) cached.rows[idx] = record;
  putDataCache(cached);
}

/**
 * cache.put lanza error si el valor supera ~100KB. Con 151 filas
 * no debería pasar, pero por seguridad el fallo de caché nunca
 * debe romper la operación principal (guardar/editar sí es crítico,
 * cachear es solo una optimización).
 */
function safeCachePut(key, value, ttl) {
  try {
    CacheService.getScriptCache().put(key, value, ttl);
  } catch (e) {
    // Se ignora: la próxima lectura simplemente irá directo a Sheets.
  }
}


/** ============================================================
 *  NÚCLEO CRUD
 * ============================================================ **/

function getSheet() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TABLE);
  if (!sheet) throw new Error('Hoja no encontrada: ' + TABLE);
  return sheet;
}


/**
 * [R] READ (interno) — Trae todas las filas, usando caché si existe.
 * Solo se golpea la hoja completa (getDataRange) cuando NO hay caché
 * válida, típicamente la primera lectura tras 20s de inactividad.
 */
function readAll() {
  const cached = getDataCache();
  if (cached) return cached;

  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const values = sheet.getDataRange().getValues();
  const rows = values.slice(1).map(row => rowToObj(headers, row));

  const payload = { headers, rows };
  putDataCache(payload);
  return payload;
}


/** [R] READ — Listar con filtros opcionales (ver doGet). */
function listRows(params) {
  const { rows } = readAll();
  let filtered = rows;

  Object.keys(params || {}).forEach(key => {
    if (['action', 'key', 'limit', 'offset', 'q'].includes(key)) return;
    filtered = filtered.filter(r => String(r[key]) === String(params[key]));
  });

  if (params.q) {
    const q = params.q.toLowerCase();
    filtered = filtered.filter(r =>
      String(r.dominio || '').toLowerCase().includes(q) ||
      String(r.comentarios || '').toLowerCase().includes(q)
    );
  }

  const offset = parseInt(params.offset || 0, 10);
  const limit = params.limit ? parseInt(params.limit, 10) : filtered.length;
  return filtered.slice(offset, offset + limit);
}


/** [R] READ — Un registro por id (usa la caché de datos en memoria). */
function getRow(id) {
  const { rows } = readAll();
  const row = rows.find(r => String(r.id) === String(id));
  if (!row) throw new Error('No encontrado: ' + id);
  return row;
}


/**
 * [C] CREATE — Guardar un nuevo registro.
 * appendRow es 1 sola operación de escritura. Tras guardar,
 * sincroniza índice y caché de datos SIN releer la hoja.
 */
function createRow(data) {
  const sheet = getSheet();
  const headers = getHeaders(sheet);

  const id = Utilities.getUuid();
  const now = new Date();
  const record = Object.assign(
    { comentarios: '' },
    data,
    { id, createdAt: now, updatedAt: now }
  );

  const rowArray = headers.map(h => record[h] !== undefined ? record[h] : '');
  sheet.appendRow(rowArray);

  const newRowNumber = sheet.getLastRow();
  setIndexEntry(id, newRowNumber);
  appendToDataCache(record);

  return record;
}


/**
 * [U] UPDATE — Editar un registro existente.
 * Usa el índice para ir DIRECTO a la fila (sin escanear toda la
 * hoja) y lee/escribe SOLO esa fila.
 */
function updateRow(id, data) {
  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const index = getIdIndex(sheet, headers);

  const rowNumber = index[id];
  if (!rowNumber) throw new Error('No encontrado: ' + id);

  const range = sheet.getRange(rowNumber, 1, 1, headers.length);
  const current = rowToObj(headers, range.getValues()[0]);

  const updated = Object.assign({}, current, data, {
    id,
    updatedAt: new Date()
  });

  const newRow = headers.map(h => updated[h] !== undefined ? updated[h] : '');
  range.setValues([newRow]);

  replaceInDataCache(updated);

  return updated;
}


/**
 * [U] BULK UPDATE — Actualiza varios registros en una sola petición.
 * Ideal para refrescar en lote (ej: vencimientos RDAP de 151 dominios)
 * sin hacer 151 llamadas HTTP ni 151 esperas de lock.
 *
 * @param {Array<{id:string, data:Object}>} items
 * @returns {Array} resultados por item (registro actualizado o error)
 */
function bulkUpdateRows(items) {
  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const index = getIdIndex(sheet, headers); // 1 sola lectura de índice para todo el lote

  const results = [];

  items.forEach(({ id, data }) => {
    const rowNumber = index[id];
    if (!rowNumber) {
      results.push({ id, error: 'No encontrado' });
      return;
    }

    const range = sheet.getRange(rowNumber, 1, 1, headers.length);
    const current = rowToObj(headers, range.getValues()[0]);
    const updated = Object.assign({}, current, data, { id, updatedAt: new Date() });
    const newRow = headers.map(h => updated[h] !== undefined ? updated[h] : '');
    range.setValues([newRow]);

    replaceInDataCache(updated);
    results.push(updated);
  });

  return results;
}


/**
 * [D] DELETE — Eliminar un registro.
 * Usa el índice para ir directo a la fila. Como borrar una fila
 * desplaza todas las siguientes, el índice y la caché de datos
 * se invalidan por completo (más simple y seguro que recalcular
 * offsets uno por uno) y se reconstruyen solos en la próxima lectura.
 */
function deleteRow(id) {
  const sheet = getSheet();
  const headers = getHeaders(sheet);
  const index = getIdIndex(sheet, headers);

  const rowNumber = index[id];
  if (!rowNumber) throw new Error('No encontrado: ' + id);

  sheet.deleteRow(rowNumber);

  invalidateIndex();
  invalidateDataCache();

  return { id, deleted: true };
}


/** ============================================================
 *  UTILIDADES
 * ============================================================ **/

function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => obj[h] = row[i]);
  return obj;
}

function checkAuth(key) {
  if (!key || key !== API_KEY) throw new Error('No autorizado (API key inválida)');
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
