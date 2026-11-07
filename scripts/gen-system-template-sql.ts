import { SYSTEM_TEMPLATE_SEEDS } from '../packages/ai/src/system-template-designs';
import { wrapHtmlInUnlayerDesign } from '../packages/ai/src/email-template-draft';

for (const t of SYSTEM_TEMPLATE_SEEDS) {
  const id = `seed-tpl-${t.name.toLowerCase().replace(/\W+/g, '-')}`;
  const design = wrapHtmlInUnlayerDesign(t.bodyHtml);
  const json = JSON.stringify(design).replace(/'/g, "''");
  console.log(`-- ${t.name}`);
  console.log(
    `UPDATE "EmailTemplate" SET "designJson" = '${json}'::jsonb WHERE id = '${id}';`,
  );
}
