import { createApp } from "./app.js";
import { openDb } from "./db.js";

const port = Number(process.env.PORT ?? 8000);
createApp(openDb()).listen(port, () => console.log(`TRAQS API listening on http://localhost:${port}/api/v1`));
