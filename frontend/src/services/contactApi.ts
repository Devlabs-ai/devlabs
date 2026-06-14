import axios from 'axios';

interface SalesInquiryPayload {
  name?: string;
  email?: string;
  company?: string;
  message?: string;
  [key: string]: unknown;
}

export async function submitSalesInquiry(payload: SalesInquiryPayload): Promise<unknown> {
  const { data } = await axios.post('/api/contact/sales', payload);
  return data;
}
