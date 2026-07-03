export interface GasDomain {
  id: string;
  dominio: string;
  tipo: string;
  subtipo: string;
  status: string;
  vencimento: string;
  dias_restantes: number;
  site: boolean;
  email: boolean;
  servidor: string;
  servidor_ip: string;
  comentarios: string;
  createdAt: string;
  updatedAt: string;
}

export interface GasApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface GasListParams {
  status?: string;
  servidor?: string;
  tipo?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Service sync payload sent to GAS */
export interface GasServiceSync {
  dominio: string;
  site: boolean;
  email: boolean;
  updatedAt: string;
}
