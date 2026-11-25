/** @type {import('next').NextConfig} */
// "standalone" output: the Docker image only ships the minimal server (multi-stage build)
const nextConfig = { output: 'standalone' };
export default nextConfig;
