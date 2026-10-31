/** @type {import('next').NextConfig} */
module.exports = {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/dashboard", destination: "/", permanent: false },
      { source: "/home", destination: "/", permanent: false },
      { source: "/driver", destination: "/", permanent: false },
      { source: "/driver/dashboard", destination: "/", permanent: false },
    ];
  },
};
