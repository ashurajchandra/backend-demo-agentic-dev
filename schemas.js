import { z } from "zod";

export const createTodoSchema = z.object({
  title: z.string({
    required_error: "title is required",
    invalid_type_error: "title must be a string"
  }).trim().min(1, { message: "title cannot be empty" }).max(140, { message: "title cannot exceed 140 characters" })
});

export const listQuerySchema = z.object({
  done: z.enum(["true", "false"], {
    errorMap: () => ({ message: "Must be 'true' or 'false'" })
  })
    .transform((val) => val === "true")
    .optional(),
  limit: z.preprocess(
    (val) => (val === undefined ? undefined : Number(val)),
    z.number().int().min(1).max(100)
  ).default(20),
  offset: z.preprocess(
    (val) => (val === undefined ? undefined : Number(val)),
    z.number().int().min(0)
  ).default(0)
});

export const idSchema = z.string().regex(/^[1-9]\d*$/, {
  message: "Must be a positive whole number"
});
