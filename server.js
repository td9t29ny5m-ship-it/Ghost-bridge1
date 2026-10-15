  let host = String((req.body && req.body.host) || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  // Prefer the Bedrock-specific endpoint when the common DonutSMP hostname is entered.
  if (/^(?:www\.)?donutsmp\.net$/i.test(host)) {
    host = 'bedrock.donutsmp.net'
    addLog('Using DonutSMP Bedrock endpoint: ' + host)
  }