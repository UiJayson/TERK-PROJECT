import type { Config, Context } from "@netlify/functions";
import { publicErrorMessage } from "../../_shared/db-errors.ts";

import { withObservability } from "../../_shared/observability.ts";

import { getSiteUrl } from "../../_shared/config.ts";

import { createId } from "../../_shared/auth-crypto.ts";

import {

  jsonResponse,

  optionsResponse,

  requireAuthWithWorkspaceAccess,

  withRole,

} from "../../_shared/auth-http.ts";

import { findUserById } from "../../_shared/auth-store.ts";

import { isPlanId, PAID_PLANS, stripePriceIdForPlan, type PlanId } from "../../_shared/billing-plans.ts";

import * as db from "../../_shared/db.ts";

import {

  initializeTransaction,

  isPaystackConfigured,

} from "../../_shared/paystack-billing.ts";

import { createCheckoutSession, createStripeCustomer } from "../../_shared/stripe-billing.ts";



function billingOrigin(req: Request): string {

  return req.headers.get("origin") ?? getSiteUrl();

}



async function handler(req: Request, _context: Context) {

  if (req.method === "OPTIONS") return optionsResponse();

  if (req.method !== "POST") {

    return jsonResponse({ error: "Method not allowed" }, { status: 405 });

  }



  const auth = await requireAuthWithWorkspaceAccess(req);

  if (auth instanceof Response) return auth;



  const denied = withRole(auth, ["owner", "admin"]);

  if (denied) return denied;



  try {

    const body = (await req.json()) as { plan?: string };

    const planId = body.plan?.trim() ?? "";



    if (!isPlanId(planId) || !PAID_PLANS.includes(planId)) {

      return jsonResponse({ error: "Invalid plan." }, { status: 400 });

    }



    const user = await findUserById(auth.user.id);

    if (!user) {

      return jsonResponse({ error: "User not found." }, { status: 404 });

    }



    const origin = billingOrigin(req);



    if (isPaystackConfigured()) {

      const result = await initializeTransaction({

        email: user.email,

        planId: planId as PlanId,

        workspaceId: auth.workspace.id,

        callbackUrl: `${origin}/app/billing?checkout=success`,

      });



      return jsonResponse({

        url: result.authorizationUrl,

        authorization_url: result.authorizationUrl,

        reference: result.reference,

        provider: "paystack",

      });

    }



    const priceId = stripePriceIdForPlan(planId as PlanId);

    if (!priceId) {

      return jsonResponse(

        { error: "Billing is not configured. Set Paystack or Stripe keys." },

        { status: 503 },

      );

    }



    const billing = await db.getWorkspaceBilling(auth.workspace.id);

    let customerId = billing.stripeCustomerId;



    if (!customerId) {

      customerId = await createStripeCustomer({

        email: user.email,

        name: user.name,

        workspaceId: auth.workspace.id,

      });

      await db.updateWorkspaceBilling(auth.workspace.id, {

        stripeCustomerId: customerId,

      });

    }



    const checkoutUrl = await createCheckoutSession({

      customerId,

      priceId,

      workspaceId: auth.workspace.id,

      planId: planId as PlanId,

      successUrl: `${origin}/app/billing?checkout=success`,

      cancelUrl: `${origin}/app/billing?checkout=cancel`,

    });



    return jsonResponse({ url: checkoutUrl, provider: "stripe", sessionId: createId("checkout") });

  } catch (error) {

    console.error("api/billing/subscribe.ts request failed:", error);
    const message = publicErrorMessage(error, "Subscribe failed");

    return jsonResponse({ error: message }, { status: 500 });

  }

}



export const config: Config = {

  path: "/api/billing/subscribe",

};



export default withObservability(handler);

