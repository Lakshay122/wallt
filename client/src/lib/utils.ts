import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Extracts a user-friendly error message from a Response object or plain JSON object.
 */
export async function getErrorMessage(responseOrData: any, fallback = "An unexpected error occurred"): Promise<string> {
  if (!responseOrData) return fallback;

  if (responseOrData instanceof Response) {
    try {
      const data = await responseOrData.clone().json();
      return data.message || data.error || fallback;
    } catch {
      try {
        const text = await responseOrData.clone().text();
        return text || responseOrData.statusText || fallback;
      } catch {
        return responseOrData.statusText || fallback;
      }
    }
  }

  return responseOrData.message || responseOrData.error || fallback;
}

/**
 * Extracts a success message from a plain JSON object.
 */
export function getSuccessMessage(data: any, fallback = "Operation completed successfully"): string {
  if (!data) return fallback;
  return data.message || data.successMessage || fallback;
}
