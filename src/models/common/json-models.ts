import {z} from "zod";

export type JsonPrimitiveType = null | boolean | number | string;
export type JsonValueType = JsonPrimitiveType | JsonValueType[] | {[key: string]: JsonValueType};
export type JsonDictType = {[key: string]: JsonValueType};

export const jsonValueSchema: z.ZodType<JsonValueType> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const jsonDictSchema = z.record(z.string(), jsonValueSchema);
