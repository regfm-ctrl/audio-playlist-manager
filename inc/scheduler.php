<?php
declare(strict_types=1);

/*
 * Sends a signed sponsorship agreement to the REGFM Traffic System (the Scheduler).
 *
 * When a client signs, the Traffic System creates a campaign for it in a "pending" state: the
 * client, dates and spots per week from the agreement, but no audio and no placements, so nothing
 * can go to air until someone sets it up there and confirms it.
 *
 * Needs two settings in inc/config.php (see config.sample.php):
 *   'traffic_system_url'    => 'https://audio-playlist-manager.vercel.app'   (this is the default)
 *   'traffic_system_secret' => the same value as PORTAL_API_SECRET in Vercel
 * The portal keeps only a hash of the API keys it hands out, so it cannot read that value back
 * itself. It needs its own copy here.
 *
 * Signing never depends on this. Every failure is caught and recorded on the agreement, where the
 * producer can see it and press "Send to Traffic System" to try again. Sending the same agreement
 * twice is safe: the Traffic System recognises it and does not make a second campaign.
 */

/* ------------------------------------------------------------ the numbers */

/** "10 x 30 second spots" -> 10. Null when the text does not start with a count. */
function scheduler_leading_count(string $text): ?int
{
    return preg_match('/^\s*(\d{1,3})\s*[x\x{00D7}]/iu', $text, $m) === 1 ? (int) $m[1] : null;
}

/** Whole weeks covered from start to finish, both days included. Null if either date is missing or unusable. */
function scheduler_term_weeks(?string $start, ?string $finish): ?int
{
    if (!$start || !$finish || !valid_date($start) || !valid_date($finish)) {
        return null;
    }
    $days = (int) round((strtotime($finish) - strtotime($start)) / 86400) + 1;
    return $days < 1 ? null : max(1, (int) ceil($days / 7));
}

/**
 * Works out spots per week from the agreement's package. Returns [spots, remark].
 * The remark is empty when the answer is certain and otherwise says what was assumed, so the person
 * setting the campaign up in the Traffic System knows what to check.
 *
 *   Standard Monthly packages  "10 x 30 second spots per week, 6 months"  -> the number is per week.
 *   Short Term packages        "20 x 30 second announcements"             -> the number is the total,
 *                              broadcast at a minimum of 5 per week, so it is spread over the term.
 */
function scheduler_spots_per_week(array $a, ?array $package, ?string $start, ?string $finish): array
{
    $label = trim((string) ($package['label'] ?? $a['package_label'] ?? ''));
    $unit = $package['unit'] ?? null;
    $qty = isset($a['quantity']) && $a['quantity'] !== null && $a['quantity'] !== '' ? (int) $a['quantity'] : null;
    $minimum = 5;

    $perWeekWording = preg_match('/\b(per|each|a) week\b/i', $label) === 1;
    if ($unit === 'month' || ($unit === null && $perWeekWording)) {
        $n = scheduler_leading_count($label);
        if ($n !== null && $n > 0) {
            return [$n, ''];
        }
    }

    $total = null;
    if ($unit === 'spot') {
        $total = $qty ?? scheduler_leading_count($label);
    } elseif ($unit === 'total' || $unit === null) {
        $total = scheduler_leading_count($label) ?? $qty;
    }

    if ($total !== null && $total > 0) {
        $weeks = scheduler_term_weeks($start, $finish);
        if ($weeks === null) {
            return [$minimum, 'Short-term package: ' . $total . ' announcements in total (minimum ' . $minimum . ' per week). '
                . 'There is no usable finish date, so ' . $minimum . ' per week was assumed. CHECK spots per week and the end date.'];
        }
        $perWeek = max($minimum, (int) ceil($total / $weeks));
        $remark = 'Short-term package: ' . $total . ' announcements in total over ' . $weeks . ' week' . ($weeks === 1 ? '' : 's')
            . ' (minimum ' . $minimum . ' per week).';
        if ($perWeek * $weeks > $total) {
            $remark .= ' ' . $perWeek . ' per week for ' . $weeks . ' weeks is more than the ' . $total . ' booked. CHECK the end date.';
        }
        return [$perWeek, $remark];
    }

    return [$minimum, 'Spots per week could not be read from the package "' . $label . '", so ' . $minimum . ' was assumed. CHECK before confirming.'];
}

/** What the Traffic System is sent for one signed agreement, plus any remarks about assumptions made. */
function scheduler_payload(array $a): array
{
    $package = !empty($a['package_id']) ? one('SELECT * FROM rate_packages WHERE id = ?', [(int) $a['package_id']]) : null;
    $remarks = [];

    $start = (string) ($a['start_date'] ?? '');
    if (!valid_date($start)) {
        $signedOn = substr((string) ($a['signed_at'] ?? ''), 0, 10);
        $start = valid_date($signedOn) ? $signedOn : date('Y-m-d');
        $remarks[] = 'The agreement had no start date, so the signing date was used. CHECK the start date.';
    }

    $finish = (string) ($a['finish_date'] ?? '');
    $hadFinish = $finish !== '';
    if ($finish !== '' && (!valid_date($finish) || $finish < $start)) {
        $remarks[] = 'The agreement finish date (' . $finish . ') was not usable, so the campaign was left open-ended. CHECK the end date.';
        $finish = '';
    }
    if (!$hadFinish && $package !== null && (int) ($package['months'] ?? 0) > 0) {
        $remarks[] = 'The package runs ' . (int) $package['months'] . ' months but the agreement has no finish date. CHECK the end date.';
    }

    [$spots, $remark] = scheduler_spots_per_week($a, $package, $start, $finish !== '' ? $finish : null);
    if ($remark !== '') {
        array_unshift($remarks, $remark);
    }

    $notes = trim((string) ($package['label'] ?? $a['package_label'] ?? ''));
    if ($remarks) {
        $notes .= ($notes !== '' ? ' | ' : '') . implode(' ', $remarks);
    }

    $client = one('SELECT business_name FROM clients WHERE id = ?', [(int) $a['client_id']]);
    $name = trim((string) ($client['business_name'] ?? '')) !== '' ? (string) $client['business_name'] : (string) $a['business_name'];

    return [
        'agreement_id'     => (string) (int) $a['id'],
        'agreement_number' => agreement_number($a),
        'client_id'        => (string) (int) $a['client_id'],
        'client_name'      => $name,
        'client_url'       => base_url('admin/client.php?id=' . (int) $a['client_id']),
        'spots_per_week'   => $spots,
        'start_date'       => $start,
        'end_date'         => $finish !== '' ? $finish : null,
        'notes'            => cut($notes, 0, 900),
    ];
}

/* ------------------------------------------------------------------ sending */

/** One JSON POST. Returns [http status (0 if none), response body, transport error text]. */
function scheduler_http_post(string $url, string $secret, array $payload): array
{
    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) {
        return [0, '', 'The agreement could not be turned into JSON.'];
    }
    $headers = ['Content-Type: application/json', 'Accept: application/json', 'Authorization: Bearer ' . $secret];

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_POSTFIELDS     => $json,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT        => 25,
            CURLOPT_FOLLOWLOCATION => false,
        ]);
        $body = curl_exec($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        return [$status, is_string($body) ? $body : '', $error];
    }

    $context = stream_context_create(['http' => [
        'method' => 'POST', 'header' => implode("\r\n", $headers) . "\r\n", 'content' => $json,
        'timeout' => 25, 'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $context);
    $status = 0;
    foreach (($http_response_header ?? []) as $line) {
        if (preg_match('#^HTTP/\S+\s+(\d{3})#', (string) $line, $m) === 1) {
            $status = (int) $m[1];
        }
    }
    return [$status, is_string($body) ? $body : '', $body === false ? 'Could not connect.' : ''];
}

/**
 * Sends one signed agreement and records what happened on it.
 * Returns ['ok' => bool, 'message' => string, 'campaign_id' => ?int, 'duplicate' => bool].
 */
function send_agreement_to_scheduler(int $agreementId): array
{
    $a = agreement_full($agreementId);
    if (!$a || $a['status'] !== 'signed') {
        return ['ok' => false, 'message' => 'Only a signed agreement can be sent to the Traffic System.', 'campaign_id' => null, 'duplicate' => false];
    }
    $number = agreement_number($a);
    $clientId = (int) $a['client_id'];

    $secret = trim((string) cfg('traffic_system_secret', ''));
    $base = rtrim(trim((string) cfg('traffic_system_url', '')) ?: 'https://audio-playlist-manager.vercel.app', '/');
    if ($secret === '') {
        return scheduler_record($agreementId, $clientId, $number, false, null, false,
            'The Traffic System connection is not set up. Add traffic_system_secret to inc/config.php (the same value as PORTAL_API_SECRET in Vercel).');
    }

    $payload = scheduler_payload($a);
    [$status, $body, $transportError] = scheduler_http_post($base . '/api/portal/agreement-signed', $secret, $payload);
    $json = json_decode($body, true);
    $json = is_array($json) ? $json : [];

    if ($status === 200 && !empty($json['ok'])) {
        $campaignId = isset($json['campaign_id']) ? (int) $json['campaign_id'] : null;
        $duplicate = !empty($json['duplicate']);
        $extended = !empty($json['extended']);
        $newEnd = (string) ($json['new_end_date'] ?? '');
        $endText = valid_date($newEnd) ? ' to ' . long_date($newEnd) : '';
        if ($extended) {
            // A renewal: the client's running campaign was extended, so no second campaign was made.
            $message = $duplicate
                ? 'The Traffic System had already extended campaign #' . $campaignId . $endText . ' for ' . $number . '. Nothing changed.'
                : 'Renewal: the existing campaign #' . $campaignId . ' in the Traffic System was extended' . $endText . ' for ' . $number . '. No new campaign was needed.'
                    . (!empty($json['audio_files_with_own_expiry']) ? ' Some of its audio files have their own expiry dates, which were not changed. Check them in Campaigns.' : '');
            return scheduler_record($agreementId, $clientId, $number, true, $campaignId, $duplicate, $message, $extended);
        }
        $message = $duplicate
            ? 'The Traffic System already had ' . $number . ' (campaign #' . $campaignId . '). Nothing new was created.'
            : 'Campaign created in the Traffic System for ' . $number . ' (campaign #' . $campaignId . ', pending). Open Campaigns there to add the audio and set the days and times.';
        return scheduler_record($agreementId, $clientId, $number, true, $campaignId, $duplicate, $message);
    }

    if ($status === 401) {
        $why = 'The Traffic System did not accept the key. Check that traffic_system_secret in inc/config.php matches PORTAL_API_SECRET in Vercel.';
    } elseif ($status === 400) {
        $why = 'The Traffic System rejected the agreement details: ' . implode('; ', array_map('strval', (array) ($json['details'] ?? [$json['error'] ?? 'unknown problem']))) . '.';
    } elseif ($status === 0) {
        $why = 'Could not reach the Traffic System' . ($transportError !== '' ? ' (' . $transportError . ')' : '') . '.';
    } else {
        $why = 'The Traffic System returned an error (HTTP ' . $status . ')' . (!empty($json['error']) ? ': ' . $json['error'] : '') . '.';
    }
    return scheduler_record($agreementId, $clientId, $number, false, null, false, $why);
}

/** Saves the outcome on the agreement and in the client's history. */
function scheduler_record(int $agreementId, int $clientId, string $number, bool $ok, ?int $campaignId, bool $duplicate, string $message, bool $extended = false): array
{
    if ($ok) {
        q('UPDATE agreements SET scheduler_sent_at = ?, scheduler_campaign_id = ?, scheduler_error = NULL WHERE id = ?', [now(), $campaignId, $agreementId]);
        log_event('agreement_to_traffic', null, $clientId, $number . ($duplicate ? ' (already there)' : '') . ($extended ? ', extended existing campaign #' : ', campaign #') . $campaignId);
    } else {
        q('UPDATE agreements SET scheduler_error = ? WHERE id = ?', [cut($message, 0, 500), $agreementId]);
        log_event('agreement_to_traffic_failed', null, $clientId, $number . ': ' . $message);
    }
    return ['ok' => $ok, 'message' => $message, 'campaign_id' => $campaignId, 'duplicate' => $duplicate];
}

/**
 * Used straight after a client signs. Sends the client on to the "signed" page first, then tells the
 * Traffic System, so a slow or unreachable Traffic System can never delay or break their signing.
 * Ends the request.
 */
function scheduler_send_after_response(int $agreementId, string $redirectUrl): void
{
    ignore_user_abort(true);
    @set_time_limit(90);
    header('Location: ' . $redirectUrl);
    header('Content-Length: 0');
    header('Connection: close');
    @session_write_close();

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        while (ob_get_level() > 0) {
            @ob_end_flush();
        }
        flush();
    }

    try {
        send_agreement_to_scheduler($agreementId);
    } catch (Throwable $e) {
        error_log('[ad-approvals] sending agreement ' . $agreementId . ' to the Traffic System failed: ' . $e->getMessage());
    }
    exit;
}
