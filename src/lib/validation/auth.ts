import { z } from "zod";

/**
 * Auth input schemas, shared by the client form and the Server Action that
 * receives it so both agree on what "valid" means.
 */

export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address")
    .pipe(z.email("Enter a valid email address"))
    .transform((value) => value.toLowerCase()),
  password: z.string().min(1, "Enter your password"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Password policy for accounts this system creates.
 *
 * Length carries most of the strength, so the floor is 10 rather than the
 * usual 8, with a single composition rule instead of a thicket of them.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(200, "That password is too long")
  .refine(
    (value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value),
    "Include at least one letter and one number",
  );

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
