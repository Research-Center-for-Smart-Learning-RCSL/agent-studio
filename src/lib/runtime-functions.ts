// The functions agent.rcsl.online executes itself (kebbi-browser-backend:
// handle_tool_calls_responses_api, get_llm_function_tools, workspace_handler).
// A function the model calls under any other name gets "Unknown tool" back, so
// the editor lists these and flags configured functions that are not here.
// Keep in sync with that backend; docs/runtime-functions.md says how.
export type RuntimeFunction = {
  name: string;
  /** Chinese source text; translated at display time and covered by the i18n test. */
  description: string;
  tool: Record<string, unknown>;
};

const noArguments = { type: "object", properties: {}, additionalProperties: false };
const scope = {
  type: "string",
  enum: ["shared", "user"],
  description:
    "shared: files shared with every user of this agent. user: the signed-in user's own files for this agent.",
};
const uploadSource = {
  type: { type: "string", enum: ["image", "audio", "path"] },
  value: {
    type: "string",
    description:
      "Required for path: the actual sandbox file path under /mnt/data/. Omit for image and audio.",
  },
};

function fn(name: string, description: string, summary: string, parameters: Record<string, unknown>, strict?: false): RuntimeFunction {
  return {
    name,
    description: summary,
    tool: { type: "function", name, description, ...(strict === false ? { strict } : {}), parameters },
  };
}

export const runtimeFunctions: RuntimeFunction[] = [
  fn("upload_image", "Upload the latest user-provided image to RCSL and return its URL.",
    "上傳使用者最新提供的圖片並回傳網址", noArguments),
  fn("upload_audio", "Upload the latest user-recorded STT audio to RCSL and return its URL. The audio recording is handled by the code.",
    "上傳使用者最新錄製的語音並回傳網址", { ...noArguments, required: [] }, false),
  fn("upload_file",
    "Upload a file to RCSL and return its URL. Use image for the latest user-provided image, audio for the latest user-recorded STT audio, or path for a sandbox file. For path, provide its sandbox path in value.",
    "上傳圖片、語音或沙盒檔案並回傳網址",
    { type: "object", properties: uploadSource, additionalProperties: false, required: ["type"] }, false),
  fn("database_operation",
    "Query robot data. Provide EXACTLY ONE argument per call: robot_name (robotCategoryApi lookup) OR sql_query (sqlCommand endpoint). Never send both, and never send neither.",
    "以機器人名稱或 SQL 查詢機器人資料",
    {
      type: "object",
      properties: {
        robot_name: { type: "string", description: "Robot name for robotCategoryApi. Use alone; omit sql_query." },
        sql_query: { type: "string", description: "SQL query for the sqlCommand endpoint. Use alone; omit robot_name." },
      },
      additionalProperties: false,
    }),
  fn("set_timeout", "Set timeout seconds for conversation flow control.",
    "設定對話流程的逾時秒數",
    {
      type: "object",
      properties: { timeout_seconds: { type: "number", description: "Timeout in seconds." } },
      required: ["timeout_seconds"],
      additionalProperties: false,
    }),
  fn("workspace_list", "List the files in one of this agent's workspaces.",
    "列出此 agent 工作區中的檔案",
    { type: "object", properties: { scope }, additionalProperties: false, required: ["scope"] }, false),
  fn("workspace_download",
    "Read a file from a workspace by its exact file_name from workspace_list. Text files return their content; other files return only their URL.",
    "讀取工作區中的檔案",
    {
      type: "object",
      properties: { scope, file_name: { type: "string", description: "Exact file_name as returned by workspace_list." } },
      additionalProperties: false,
      required: ["scope", "file_name"],
    }, false),
  fn("workspace_upload",
    "Save a file into a workspace and return its URL. Use image for the latest user-provided image, audio for the latest user-recorded STT audio, or path for a sandbox file. For path, provide the actual sandbox path under /mnt/data/ in value. An existing file name is never overwritten; the new file gets a unique suffix.",
    "將檔案存入工作區並回傳網址",
    { type: "object", properties: { scope, ...uploadSource }, additionalProperties: false, required: ["scope", "type"] }, false),
];

export const runtimeFunctionNames = new Set(runtimeFunctions.map(({ name }) => name));
