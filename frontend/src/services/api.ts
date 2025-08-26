import axios, { InternalAxiosRequestConfig } from 'axios';

// The base URL for your backend API
export const API_URL: string = 'http://localhost:3001';

const api = axios.create({
  baseURL: API_URL,
});

// Add types to the interceptor's config parameter
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

export default api;