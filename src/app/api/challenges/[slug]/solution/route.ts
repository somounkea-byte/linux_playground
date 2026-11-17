import { route } from "@/server/http";
import { getSolution } from "@/server/services/challenges";

export const GET = route<{ slug: string }>({}, async ({ user, params }) => getSolution(user, params.slug));
