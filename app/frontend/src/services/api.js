import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:8000",
});

export const predict = async (file, task) => {
  const form = new FormData();
  form.append("file", file);
  const response = await API.post(`/predict?task=${task}`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return response.data;
};