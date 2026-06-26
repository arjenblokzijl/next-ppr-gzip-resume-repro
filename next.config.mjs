/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enables Cache Components / PPR, which makes routes with a static shell +
  // dynamic Suspense hole render as Partial Prerender (◐) and produce a
  // postponed state that is resumed at request time.
  cacheComponents: true,
};

export default nextConfig;
