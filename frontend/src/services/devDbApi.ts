import axios from 'axios';
import { getAuthHeader } from './authApi';

export interface DbTableMeta {
  name: string;
  rowCount: number;
}

export interface DbColumnMeta {
  name: string;
  dataType: string;
}

export interface DbTableRowsResult {
  table: string;
  columns: DbColumnMeta[];
  rows: Record<string, unknown>[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sort: string;
  order: string;
}

export async function fetchDbTables(): Promise<DbTableMeta[]> {
  const { data } = await axios.get<{ tables: DbTableMeta[] }>('/api/dev/db/tables', {
    headers: getAuthHeader(),
  });
  return data.tables;
}

export async function fetchDbTableRows(
  table: string,
  { page = 1, limit = 50, sort = '', order = 'desc', q = '' }: {
    page?: number;
    limit?: number;
    sort?: string;
    order?: string;
    q?: string;
  } = {},
): Promise<DbTableRowsResult> {
  const params: Record<string, string | number> = { page, limit, order };
  if (sort) params.sort = sort;
  if (q) params.q = q;
  const { data } = await axios.get<DbTableRowsResult>(`/api/dev/db/tables/${encodeURIComponent(table)}`, {
    headers: getAuthHeader(),
    params,
  });
  return data;
}
