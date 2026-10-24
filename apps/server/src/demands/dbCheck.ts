import pg from "pg";

const TABLES = ["clients", "demands", "demand_videos", "demand_events", "notifications", "settings"];

/**
 * Confere a conexão do Vision com o banco compartilhado SEM gravar nada:
 * quem está conectado, se as tabelas do schema vision respondem e se o
 * usuário está mesmo restrito (não pode criar nada em public nem ver tabelas
 * de outros schemas). Devolve false se algo não bate.
 */
export async function checkDatabase(url: string): Promise<boolean> {
  const client = new pg.Client({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    application_name: "vision-check",
  });
  let ok = true;
  const line = (good: boolean, msg: string) => {
    if (!good) ok = false;
    console.log(`${good ? "ok  " : "ERRO"}  ${msg}`);
  };

  await client.connect();
  try {
    const me = (
      await client.query(
        "select current_user u, (select rolsuper from pg_roles where rolname = current_user) su, (select rolbypassrls from pg_roles where rolname = current_user) bypass"
      )
    ).rows[0];
    line(me.u === "vision_app", `conectado como "${me.u}" (esperado: vision_app)`);
    line(!me.su && !me.bypass, "usuário sem superpoderes (não é superusuário nem ignora RLS)");

    for (const t of TABLES) {
      try {
        await client.query(`select 1 from vision.${t} limit 1`);
        line(true, `vision.${t} acessível`);
      } catch (e) {
        line(false, `vision.${t}: ${(e as Error).message}`);
      }
    }

    const create = (
      await client.query(
        "select has_schema_privilege(current_user, 'public', 'CREATE') pub, has_schema_privilege(current_user, 'vision', 'CREATE') vis"
      )
    ).rows[0];
    line(!create.pub, "não pode criar nada em public");
    line(!create.vis, "não pode alterar a estrutura do schema vision");

    const visible = (
      await client.query(
        `select table_schema || '.' || table_name t from information_schema.table_privileges
         where grantee in (current_user, 'PUBLIC') and table_schema not in ('vision', 'pg_catalog', 'information_schema')
         group by 1 order by 1 limit 20`
      )
    ).rows.map((r) => r.t as string);
    // o schema "extensions" do Supabase traz visões de monitoramento liberadas a
    // todos (pg_stat_statements): não são dados de outro sistema
    const monitoring = visible.filter((t) => t.startsWith("extensions."));
    const others = visible.filter((t) => !t.startsWith("extensions."));
    line(
      others.length === 0,
      others.length === 0
        ? "nenhuma tabela de dados de outros schemas visível para o vision_app"
        : `tabelas de outros schemas com permissão para vision_app/PUBLIC: ${others.join(", ")}`
    );
    if (monitoring.length > 0) {
      console.log(`info  visões de monitoramento do Supabase, abertas a todos por padrão: ${monitoring.join(", ")}`);
    }
  } finally {
    await client.end();
  }
  return ok;
}
