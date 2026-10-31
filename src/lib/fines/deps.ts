import { getOdooClient } from "../odoo/client";
import { getOcrProvider } from "./ocr";
import { localStorage_ } from "../storage";
import { prismaFineRepo } from "./repo-prisma";
import type { Deps } from "./pipeline";
export const fineDeps = (): Deps => ({ odoo: getOdooClient(), ocr: getOcrProvider, storage: localStorage_(), repo: prismaFineRepo });
