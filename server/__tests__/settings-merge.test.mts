// Settings merge semantics: undefined keeps, null clears.
//   createdb radioflow_settest && for f in migrations/000*.sql; do psql -d radioflow_settest -f $f; done
//   npx tsx server/__tests__/settings-merge.test.mts
process.env.DATABASE_URL = "postgres://localhost:5432/radioflow_settest";
const { pool } = await import("../db.ts");
const { storage } = await import("../storage.ts");
const U = "22222222-2222-2222-2222-222222222222";
let bad = 0;
const check = (n: string, ok: boolean, d = "") => { if (!ok) bad++; console.log(ok ? "  ok  " : "FAIL  ", n, d); };

await pool.query("DELETE FROM settings");
await pool.query(
  `INSERT INTO settings (user_id, google_drive_refresh_token, google_drive_email, storage_provider, station_name)
   VALUES ($1,'REFRESH-TOKEN-123','me@gmail.com','google_drive','Моё радио')`, [U]);

// The disconnect endpoint does exactly this.
await storage.saveSettings({ googleDriveRefreshToken: null, googleDriveEmail: null, storageProvider: "none" } as any, U);
const after = (await pool.query("SELECT * FROM settings WHERE user_id=$1", [U])).rows[0];

check("отключение Google Drive стирает refresh token", after.google_drive_refresh_token === null, `в БД: ${after.google_drive_refresh_token}`);
check("отключение стирает email", after.google_drive_email === null, `в БД: ${after.google_drive_email}`);
check("провайдер переключился на none", after.storage_provider === "none", after.storage_provider);
check("не затронутые поля сохранились", after.station_name === "Моё радио", after.station_name);

await pool.end();
console.log(bad === 0 ? "\nВСЕ ПРОШЛИ" : `\nПРОВАЛОВ: ${bad}`);
process.exit(bad ? 1 : 0);
