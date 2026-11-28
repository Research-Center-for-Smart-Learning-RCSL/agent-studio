import { installDatabaseLogWriter } from "@/lib/request-log-db";

export function registerNode() {
  installDatabaseLogWriter();
}
