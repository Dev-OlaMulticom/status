export interface WhoisInfo {
  expirationDate: string | null
  createdDate: string | null
  registrar: string | null
  nameservers: string[]
  status: string[]
}
