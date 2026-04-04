import { spawn } from "node:child_process";

export interface PythonSearchLocationRequest {
  action: "search_location";
  query: string;
  country_codes?: string;
}

export interface PythonBridgeSuccess<T> {
  ok: true;
  data: T;
}

export interface PythonBridgeFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type PythonBridgeResponse<T> = PythonBridgeSuccess<T> | PythonBridgeFailure;

export interface SearchLocationResultItem {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  display_name?: string;
  geojson?: unknown;
  [key: string]: unknown;
}

export interface SearchLocationData {
  query: string;
  country_codes: string | null;
  count: number;
  results: SearchLocationResultItem[];
}

const PYTHON_ENTRYPOINT = "python/main.py";

export function callPython<T>(
  payload: PythonSearchLocationRequest,
): Promise<PythonBridgeResponse<T>> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", [PYTHON_ENTRYPOINT], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (!stdout.trim()) {
        reject(
          new Error(
            `python process returned no stdout (exit code ${code ?? "unknown"}): ${stderr.trim()}`,
          ),
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout) as PythonBridgeResponse<T>);
      } catch (error) {
        reject(
          new Error(
            `failed to parse python stdout as json: ${String(error)}\nstderr: ${stderr.trim()}\nstdout: ${stdout.trim()}`,
          ),
        );
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export function searchLocation(
  query: string,
  countryCodes?: string,
): Promise<PythonBridgeResponse<SearchLocationData>> {
  return callPython<SearchLocationData>({
    action: "search_location",
    query,
    country_codes: countryCodes,
  });
}
