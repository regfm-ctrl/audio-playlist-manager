<?php
declare(strict_types=1);
require __DIR__ . '/../inc/bootstrap.php';
$admin = require_admin();

/* Preview of one agreement, exactly as the client will see it, with the actions for its current stage. */

$agreementId = (int) ($_GET['id'] ?? 0);
$agreement = agreement_full($agreementId);
if (!$agreement) {
    http_response_code(404);
    admin_header('Agreement not found', 'clients');
    echo '<h1>Agreement not found</h1><p><a href="' . h(base_url('admin/clients.php')) . '">Back to clients</a></p>';
    admin_footer();
    exit;
}
$self = 'admin/agreement-view.php?id=' . $agreementId;
$clientId = (int) $agreement['client_id'];
$number = agreement_number($agreement);
$status = $agreement['status'];

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    csrf_check();
    $action = post('action');

    if ($action === 'send' && $status !== 'signed') {
        q("UPDATE agreements SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?", [now(), now(), $agreementId]);
        [$sent, $failures, $total] = notify_client_agreement($agreement);
        if ($total === 0) {
            flash('warn', $number . ' is now open on the client\'s page, but this client has no contacts set to get emails, so nobody was notified.');
        } elseif ($failures) {
            flash('error', $number . ' is open on the client\'s page, but ' . count($failures) . ' email(s) failed: ' . implode('; ', $failures));
        } else {
            flash('ok', $number . ' sent to ' . $sent . ($sent === 1 ? ' contact.' : ' contacts.'));
        }
    } elseif ($action === 'send_traffic' && $status === 'signed') {
        $result = send_agreement_to_scheduler($agreementId);
        flash($result['ok'] ? 'ok' : 'error', $result['message']);
    } elseif ($action === 'delete') {
        if ($status === 'signed' && !is_full_admin()) {
            flash('error', 'Only an admin can delete a signed agreement.');
        } else {
            delete_agreement_file($agreement['signature_file']);
            delete_agreement_file($agreement['signed_pdf']);
            q('DELETE FROM agreements WHERE id = ?', [$agreementId]);
            log_event('agreement_deleted', null, $clientId, $number . ' (' . agreement_statuses()[$status] . ') deleted by ' . $admin['name']);
            flash('ok', 'Agreement ' . $number . ' deleted.');
            redirect('admin/client.php?id=' . $clientId);
        }
    }
    redirect($self);
}

$station = agreement_station($agreement);
$contacts = all('SELECT * FROM contacts WHERE client_id = ? AND notify = 1 ORDER BY id', [$clientId]);
$logoUrl = agreement_logo_path(agreement_settings($station)) ? base_url('logo.php?station=' . (int) $agreement['station_id']) : null;
$sigUrl = $agreement['signature_file'] ? base_url('admin/agreement-file.php?id=' . $agreementId . '&sig=1') : null;
$pdfUrl = base_url('admin/agreement-file.php?id=' . $agreementId);

admin_header('Agreement ' . $number . ' | ' . $agreement['business_name'], 'clients');
?>
<p class="crumb"><a href="<?= h(base_url('admin/client.php?id=' . $clientId)) ?>"><?= h($agreement['client_business']) ?></a></p>
<div class="titlebar">
  <div>
    <h1>Agreement <?= h($number) ?></h1>
    <p class="status-line"><?= agreement_tally($status) ?>
      <?php if ($status === 'signed'): ?><span>Signed by <?= h($agreement['signer_name']) ?> on <?= h(fmt_dt($agreement['signed_at'])) ?></span>
      <?php elseif ($status === 'sent'): ?><span>Sent <?= h(time_ago($agreement['sent_at'])) ?></span><?php endif; ?>
    </p>
  </div>
  <div class="titlebar-actions">
    <?php if ($status !== 'signed'): ?><a class="btn" href="<?= h(base_url('admin/agreement.php?id=' . $agreementId)) ?>">Edit</a><?php endif; ?>
    <a class="btn" href="<?= h($pdfUrl) ?>"><?= $status === 'signed' ? 'Download signed PDF' : 'Download PDF' ?></a>
  </div>
</div>

<div class="split">
  <div>
    <?= agreement_pdf_view(
        base_url('admin/agreement-file.php?id=' . $agreementId . '&view=1&r=' . (int) $agreement['revision'] . '-' . $status),
        agreement_html($agreement, $station, $logoUrl, $sigUrl)
    ) ?>
    <p class="hint">This is the PDF the client sees and signs.</p>
  </div>

  <aside>
    <?php if ($status === 'draft'): ?>
      <section class="panel stack">
        <h2>Send to the client</h2>
        <p class="hint">Check the preview. When it is right, send it. The client gets an email with a link, and the agreement appears on their page to sign or to ask for changes.</p>
        <form method="post"><?= csrf_field() ?>
          <button class="btn btn-primary" name="action" value="send">Send to client</button>
        </form>
        <p class="hint">Goes to: <?= $contacts ? h(implode(', ', array_map(function (array $c): string { return $c['name'] . ' <' . $c['email'] . '>'; }, $contacts))) : 'nobody (no contacts get emails)' ?></p>
      </section>
    <?php elseif ($status === 'changes_requested'): ?>
      <section class="panel stack">
        <h2>The client asked for changes</h2>
        <div class="note note-client">
          <p class="note-who"><?= h((string) $agreement['change_requested_by']) ?>, <?= h(fmt_dt($agreement['change_requested_at'])) ?></p>
          <?= note_html((string) $agreement['change_request']) ?>
        </div>
        <p class="hint">Edit the agreement, then send it again.</p>
        <div class="formactions">
          <a class="btn btn-primary" href="<?= h(base_url('admin/agreement.php?id=' . $agreementId)) ?>">Edit agreement</a>
          <form method="post"><?= csrf_field() ?>
            <button class="btn" name="action" value="send" data-confirm="Send <?= h($number) ?> to the client again?">Send again</button>
          </form>
        </div>
      </section>
    <?php elseif ($status === 'sent'): ?>
      <section class="panel stack">
        <h2>Waiting for the client</h2>
        <p class="hint">It is on their page to sign. If you edit it now, they will be asked to read the updated version before signing.</p>
        <form method="post"><?= csrf_field() ?>
          <button class="btn btn-small" name="action" value="send" data-confirm="Email <?= h($number) ?> to this client's contacts again?">Email the client again</button>
        </form>
      </section>
    <?php else: ?>
      <section class="panel stack">
        <h2>Signed</h2>
        <p><strong><?= h($agreement['signer_name']) ?></strong><?= trim((string) $agreement['signer_position']) !== '' ? ', ' . h($agreement['signer_position']) : '' ?></p>
        <p class="hint">Signed electronically on <?= h(fmt_dt($agreement['signed_at'])) ?><?= $agreement['signed_ip'] ? ' from IP address ' . h($agreement['signed_ip']) : '' ?>.</p>
        <p class="hint">A signed agreement is locked. The PDF was made at the moment of signing and is kept as it was then.</p>
        <p><a class="btn btn-primary" href="<?= h($pdfUrl) ?>">Download signed PDF</a></p>
      </section>
      <section class="panel stack">
        <h2>Traffic System</h2>
        <?php if (!empty($agreement['scheduler_sent_at'])): ?>
          <p>Sent on <?= h(fmt_dt($agreement['scheduler_sent_at'])) ?><?= !empty($agreement['scheduler_campaign_id']) ? ' as campaign #' . (int) $agreement['scheduler_campaign_id'] : '' ?>.</p>
          <?php $wasRenewal = one("SELECT id FROM events WHERE type = 'agreement_to_traffic' AND client_id = ? AND detail LIKE ? ORDER BY id DESC LIMIT 1", [$clientId, $number . '%extended existing campaign%']); ?>
          <?php if ($wasRenewal): ?>
            <p class="hint">This was a renewal: the client's running campaign was <strong>extended</strong> to this agreement's end date, so no new campaign was made. Their audio and schedule carry on as they were.</p>
          <?php else: ?>
            <p class="hint">It is waiting in Campaigns as <strong>pending</strong>. Open it there, add the audio, choose the days and times, then confirm.</p>
          <?php endif; ?>
        <?php else: ?>
          <p><strong>Not in the Traffic System yet.</strong></p>
          <?php if (!empty($agreement['scheduler_error'])): ?><p class="hint"><?= h($agreement['scheduler_error']) ?></p><?php endif; ?>
        <?php endif; ?>
        <form method="post"><?= csrf_field() ?>
          <button class="btn btn-small" name="action" value="send_traffic"<?= !empty($agreement['scheduler_sent_at']) ? ' data-confirm="Send ' . h($number) . ' to the Traffic System again? If it is already there, nothing new is created."' : '' ?>><?= !empty($agreement['scheduler_sent_at']) ? 'Send again' : 'Send to Traffic System' ?></button>
        </form>
      </section>
      <?php if (can_see_money()): $feePlan = one('SELECT * FROM client_fees WHERE client_id = ?', [$clientId]); ?>
      <section class="panel stack">
        <h2>Fees</h2>
        <?php if ($feePlan): ?>
          <p>The client pays <strong><?= h(fee_label($feePlan)) ?></strong>, first due <?= h(long_date($feePlan['first_due'])) ?>.
            <?= $feePlan['source'] === 'agreement' && (int) $feePlan['agreement_id'] === $agreementId ? 'These came from this agreement.' : ($feePlan['source'] === 'agreement' ? 'These came from another agreement.' : 'These were entered by hand.') ?></p>
          <?php if ((int) ($feePlan['agreement_id'] ?? 0) !== $agreementId): $f = fee_from_agreement($agreement); ?>
            <p class="hint">This agreement says <?= h(fee_label($f)) ?> from <?= h(long_date($f['first_due'])) ?>. To use it instead, open Payments.</p>
          <?php endif; ?>
        <?php else: ?>
          <p><strong>No fees are set for this client yet.</strong></p>
          <p class="hint">Fees normally start by themselves when an agreement is signed. This one was signed before that, so set them up in Payments.</p>
        <?php endif; ?>
        <p><a class="btn btn-small" href="<?= h(base_url('admin/payments.php?client=' . $clientId . '#fees')) ?>">Open payments</a></p>
      </section>
      <?php endif; ?>
    <?php endif; ?>

    <?php if ($status !== 'draft' && $status !== 'signed'): ?>
      <section class="panel stack">
        <h2>Client link for this agreement</h2>
        <div class="copyrow">
          <input id="agreementLink" value="<?= h(agreement_review_url($agreement['token'], $agreementId)) ?>" readonly aria-label="Client link for this agreement">
          <button type="button" class="btn btn-small" data-copy="agreementLink">Copy link</button>
        </div>
        <p class="hint">Opening it while you are signed in here does not count as the client opening it.</p>
      </section>
    <?php endif; ?>

    <?php if ($status !== 'signed' || is_full_admin()): ?>
      <form method="post" class="danger-zone"><?= csrf_field() ?>
        <button class="btn btn-small btn-danger" name="action" value="delete" data-confirm="Delete agreement <?= h($number) ?>?<?= $status === 'signed' ? ' It has been signed. The signed copy will be deleted too.' : '' ?> This cannot be undone.">Delete this agreement</button>
      </form>
    <?php endif; ?>
  </aside>
</div>
<?php admin_footer();
