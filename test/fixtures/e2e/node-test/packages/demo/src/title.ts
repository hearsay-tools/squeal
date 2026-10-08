import { slug } from "@reference/util";

export const title = (s: string): string => `post/${slug(s)}`;
