import { fetchJsonWithTimeout } from "./request";
import {
  csvMappingResponseSchema,
  parseWithSchema,
  type CSVMappingResponse,
} from "../utils/validation";

export async function mapCsvColumns(
  headers: string[],
  sampleRows: string[][]
): Promise<CSVMappingResponse> {
  const payload = await fetchJsonWithTimeout<unknown>(
    "/api/map-csv-columns",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ headers, sampleRows }),
    },
    "CSV column mapping failed"
  );

  return parseWithSchema(csvMappingResponseSchema, payload, "mapCsvColumns");
}

