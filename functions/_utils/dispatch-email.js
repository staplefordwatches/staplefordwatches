const ORIGIN = 'https://staplefordwatches.co.uk';
const EMAIL = 'ben@staplefordwatches.co.uk';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function required(value, name) {
  const text = String(value ?? '').trim();
  if (!text || /[\r\n\u0000]/.test(text)) throw new Error(`${name} is required and must be a single line.`);
  return text;
}

// Rendering only. The sender must call this after confirming actual dispatch.
export function renderDispatchEmail(data) {
  const customerName = required(data.customerName ?? data.firstName, 'Customer name');
  const watchName = required(data.watchName, 'Watch name and model');
  const orderNumber = required(data.orderNumber, 'Order number');
  const trackingNumber = required(data.trackingNumber, 'Tracking number');
  // The dispatch record can supply a verified destination partner link for
  // overseas parcels. Otherwise keep the shipment's original courier link.
  const trackingUrl = new URL(required(data.destinationTrackingUrl || data.trackingUrl, 'Tracking URL'));
  if (trackingUrl.protocol !== 'https:' || trackingUrl.username || trackingUrl.password) {
    throw new Error('Tracking URL must be an HTTPS link without credentials.');
  }
  const year = data.year ?? new Date().getUTCFullYear();
  if (!Number.isInteger(year) || year < 2026 || year > 9999) throw new Error('Invalid copyright year.');
  const subject = `Your Stapleford Watches order is on its way – order ${orderNumber}`;
  const linkStyle = 'display:inline-block;color:#fff;text-decoration:none;font-size:11px;line-height:24px;letter-spacing:.4px;margin-right:14px;white-space:nowrap';
  const footerLinks = items => items.map(([label, url]) => `<a href="${url}" style="${linkStyle}">${label}</a>`).join(' ');
  const explore = footerLinks([['BUY', `${ORIGIN}/buy/`], ['SELL', `${ORIGIN}/sell/`], ['JOURNAL', `${ORIGIN}/journal/`], ['CONTACT', `${ORIGIN}/contact/`]]);
  const connect = footerLinks([['EMAIL', `mailto:${EMAIL}`], ['WHATSAPP', 'https://wa.me/447438196047'], ['INSTAGRAM', 'https://instagram.com/staplefordwatches'], ['TIKTOK', 'https://tiktok.com/@staplefordwatches'], ['YOUTUBE', 'https://youtube.com/@staplefordwatches']]);
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title>
<style>.sw-tracking-button,.sw-tracking-button:link,.sw-tracking-button:visited,.sw-tracking-button span{color:#ffffff!important;text-decoration:none!important}.sw-footer-tag,.sw-footer-tag span{color:#ffffff!important}@media only screen and (max-width:620px){.sw-outer{padding:0!important}.sw-email{width:100%!important}.sw-pad{padding-left:26px!important;padding-right:26px!important}}</style></head>
<body style="margin:0;padding:0;background:#f2f2f0;color:#0a2342;font-family:Arial,Helvetica,sans-serif">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">Your ${escape(watchName)} is now en route. Track your shipment.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f2f2f0"><tr><td class="sw-outer" align="center" style="padding:28px 16px">
<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]-->
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="sw-email" style="width:100%;max-width:600px;background:#fff;color:#0a2342;font-family:Arial,Helvetica,sans-serif">
<tr><td align="center" style="padding:34px 26px 38px"><a href="${ORIGIN}"><img src="${ORIGIN}/assets/stapleford-watches-logo-navy@2x.png" alt="Stapleford Watches" width="65" height="79" style="display:block;width:65px;height:79px;border:0"></a></td></tr>
<tr><td class="sw-pad" style="padding:0 40px 32px;font-size:14px;line-height:1.75">
<p style="margin:0 0 22px">Dear ${escape(customerName)},</p>
<p style="margin:0">Your ${escape(watchName)} is now en route. Tracking may take some time to update.</p>
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 0;border-collapse:separate;border-spacing:0"><tr><td align="left" style="padding:0;text-align:left">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escape(trackingUrl.href)}" style="height:46px;v-text-anchor:middle;width:220px" arcsize="100%" strokecolor="#0a2342" fillcolor="#0a2342"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:.6px">TRACK YOUR SHIPMENT</center></v:roundrect><![endif]-->
<!--[if !mso]><!--><a class="sw-tracking-button" href="${escape(trackingUrl.href)}" style="display:inline-block;box-sizing:border-box;min-height:46px;padding:0 24px;background-color:#0a2342!important;border:1px solid #0a2342;border-radius:24px;color:#ffffff!important;text-align:center;text-decoration:none!important;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:44px;letter-spacing:.6px;white-space:nowrap;-webkit-text-size-adjust:none;mso-hide:all"><span style="color:#ffffff!important;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:44px;letter-spacing:.6px">TRACK YOUR SHIPMENT</span></a><!--<![endif]-->
</td></tr></table>
<p style="margin:11px 0 24px;font-size:12px;line-height:1.6;color:#536376;overflow-wrap:anywhere">Tracking number: ${escape(trackingNumber)}</p>
<p style="margin:0 0 22px">Thank you for choosing Stapleford Watches.</p>
<p style="margin:0 0 22px">If you have any questions, please don’t hesitate to get in touch.</p>
<p style="margin:0">Best regards,<br>Ben<br><a href="tel:+447438196047" style="color:#0a2342;text-decoration:none">+44 7438 196047</a><br><a href="mailto:${EMAIL}" style="color:#0a2342;text-decoration:none">${EMAIL}</a><br><a href="${ORIGIN}" style="color:#0a2342;text-decoration:none">staplefordwatches.co.uk</a></p>
</td></tr>
<tr><td class="sw-pad" bgcolor="#0a2342" style="padding:30px 40px 26px;background:#0a2342;color:#fff">
<p class="sw-footer-tag" style="margin:0 0 24px;color:#ffffff!important;font-size:15px;line-height:1.5;letter-spacing:.1px"><span style="color:#ffffff!important">It’s a good day to buy another watch</span></p>
<p style="margin:0 0 5px;color:#b0bac6;font-size:11px;line-height:1.5;letter-spacing:.6px">EXPLORE</p>
<p style="margin:0 0 17px;font-size:11px;line-height:24px">${explore}</p>
<p style="margin:0 0 5px;color:#b0bac6;font-size:11px;line-height:1.5;letter-spacing:.6px">CONNECT</p>
<p style="margin:0;font-size:11px;line-height:24px">${connect}</p>
<p style="margin:25px 0 0;color:#b0bac6;font-size:11px;line-height:1.5">© ${year} Stapleford Watches</p>
</td></tr></table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
  const text = [
    `Dear ${customerName},`, '',
    `Your ${watchName} is now en route. Tracking may take some time to update.`, '',
    'TRACK YOUR SHIPMENT', trackingUrl.href, `Tracking number: ${trackingNumber}`, '',
    'Thank you for choosing Stapleford Watches.', '',
    'If you have any questions, please don’t hesitate to get in touch.', '',
    'Best regards,', 'Ben', '+44 7438 196047', EMAIL, 'staplefordwatches.co.uk', '',
    'It’s a good day to buy another watch', '',
    'EXPLORE', `Buy: ${ORIGIN}/buy/`, `Sell: ${ORIGIN}/sell/`, `Journal: ${ORIGIN}/journal/`, `Contact: ${ORIGIN}/contact/`, '',
    'CONNECT', `Email: ${EMAIL}`, 'WhatsApp: https://wa.me/447438196047',
    'Instagram: https://instagram.com/staplefordwatches', 'TikTok: https://tiktok.com/@staplefordwatches', 'YouTube: https://youtube.com/@staplefordwatches', '',
    `© ${year} Stapleford Watches`
  ].join('\n');
  return { subject, html, text };
}
