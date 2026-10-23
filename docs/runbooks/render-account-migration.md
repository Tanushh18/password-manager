# Safe Render account migration

Stashr cannot transfer an existing Render service object between workspaces. This workflow recreates the service under the destination Render account, updates connected frontend environment variables, transfers custom-domain mappings, verifies the replacement, relinks the project, and only then permits deletion of the original service.

## Workflow

1. **Plan:** Check the source service, destination account/workspace, connected frontend environment variables and custom domains. The old service remains untouched.
2. **Create and wait:** Create a replacement using the same repository, branch, runtime/build/start settings, region/plan and environment-variable values. The wizard polls Render until the latest deployment reports `live`.
3. **Update connected frontends:** Replace references to the old generated Render hostname in selected Render services' environment variables and automatically redeploy those frontends. A failed variable update or redeploy must be retried before continuing.
4. **Transfer custom-domain mappings:** Add the source service's custom domains to the replacement. If Render returns a conflict because a domain is still attached to the source, the wizard releases that domain from the source and retries the add; if reattaching fails, it attempts to restore the old mapping and reports the handoff for manual inspection.
5. **Update DNS and verify:** DNS is managed by the domain's DNS provider, not by the Render service API. For a CNAME/ALIAS record targeting the old `.onrender.com` hostname, update it to the new service's hostname. Apex/root domains may use a provider-specific Render A/ALIAS/CNAME setup; follow the instructions for the actual DNS provider instead of changing records blindly. Then use the wizard's domain-verification check and manually test the domain.
6. **Verify traffic and relink:** Open the replacement and a frontend, exercise a real request, and confirm the request reaches the new service. The project link is not switched until the replacement deployment is live and every expected custom domain reports verified.
7. **Delete source last:** The backend refuses deletion unless the project has been relinked through the wizard, the replacement is live, all expected custom domains are verified, the old generated URL no longer appears in readable environment variables of connected Render services, and the exact old service name is confirmed.

## Return to the original account

The first successful migration records the original Render account in the encrypted project metadata. On a later migration, the wizard offers **Return to original account** when that account is still connected. It runs the same replacement, frontend-update, domain-verification and old-service safeguards in reverse. Keep the old service until the reverse migration is verified.

## Important boundaries

- The Render API provides custom-domain add/list/verify/delete operations; it does not edit DNS records at an external provider. Domain mappings are automated, but DNS edits remain manual unless a separately authorized DNS-provider integration is implemented.
- A domain marked verified on the old service does not by itself mean requests are routed to the new service. The DNS target and the new Render service's domain mapping both need to be correct.
- The workflow rewrites environment variables on connected Render services. URLs hard-coded in source code, configuration files outside those environment variables, third-party callers, and bookmarks are not automatically rewritten.
- The old service's `.onrender.com` address cannot keep forwarding after the old service is deleted. Use a stable custom domain for callers that need an address across migrations, or keep a deliberate proxy/redirect service at the old address.
- Render's custom-domain instructions: [Custom domains](https://render.com/docs/custom-domains), [Other DNS providers](https://render.com/docs/configure-other-dns), and [Cloudflare DNS](https://render.com/docs/configure-cloudflare-dns).
