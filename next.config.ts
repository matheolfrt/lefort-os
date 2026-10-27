import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // the update page reads the SQL files of supabase/migrations at run time
  outputFileTracingIncludes: {
    "/parametres/mises-a-jour": ["./supabase/migrations/*.sql"],
  },
};

export default nextConfig;
