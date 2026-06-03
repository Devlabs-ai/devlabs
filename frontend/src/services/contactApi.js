import axios from 'axios';

export async function submitSalesInquiry(payload) {
  const { data } = await axios.post('/api/contact/sales', payload);
  return data;
}
