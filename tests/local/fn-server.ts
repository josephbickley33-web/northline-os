// LOCAL TEST ONLY: serves the real Edge Function handlers on :54339 (the gateway proxies /functions/v1/* here).
// Started without Stripe secrets, so billing must report "not connected".
import { handler as checkout } from "../../supabase/functions/billing-checkout/handler.ts";
import { handler as portal } from "../../supabase/functions/billing-portal/handler.ts";
import { handler as webhook } from "../../supabase/functions/stripe-webhook/handler.ts";
const routes: Record<string, (r: Request) => Promise<Response>> = { "/billing-checkout": checkout, "/billing-portal": portal, "/stripe-webhook": webhook };
Deno.serve({ port: 54339 }, (req) => { const h = routes[new URL(req.url).pathname]; return h ? h(req) : new Response("not found", { status: 404 }); });
