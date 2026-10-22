import type {NextConfig} from 'next';
const config:NextConfig={output:'standalone',poweredByHeader:false,reactStrictMode:true,experimental:{cpus:1},typescript:{ignoreBuildErrors:false},images:{unoptimized:true}};
export default config;
