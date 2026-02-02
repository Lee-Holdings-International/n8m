import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import path from "path";
import fs from "fs";
import os from "os";

// Ensure the local storage directory exists
const HOME_DIR = os.homedir();
const CONFIG_DIR = path.join(HOME_DIR, ".n8m");
const DB_PATH = path.join(CONFIG_DIR, "state.db");

if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Create a singleton checkpointer instance
// Using simple string path is supported by the library
export const checkpointer = SqliteSaver.fromConnString(DB_PATH);
