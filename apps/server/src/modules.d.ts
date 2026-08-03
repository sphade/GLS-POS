// Drizzle's generated migration bundles import raw .sql files as text modules
// (enabled at runtime by the wrangler Text rule for **/*.sql).
declare module "*.sql" {
  const content: string;
  export default content;
}
