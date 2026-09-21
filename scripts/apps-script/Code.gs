function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    var spreadsheetId = '1yT3W-DVkxXPoC-8KTJar2NPk7B8TpB7a-Dh_rIZWYrA';
    var ss = SpreadsheetApp.openById(spreadsheetId);
    var sheet = ss.getSheetByName('Sheet1') || ss.getSheets()[0];

    var params = (e && e.parameter) || {};
    var postData = {};
    if (e && e.postData && e.postData.contents) {
      try {
        postData = JSON.parse(e.postData.contents);
      } catch (err) {}
    }

    var name = params.name || postData.name || '';
    var email = params.email || postData.email || '';
    var phone = params.phone || postData.phone || '';
    var partner = params.partner || postData.partner || 'None';
    var redirectUrl = params.redirect_url || postData.redirect_url || '';
    var reference = params.reference || postData.reference || '';
    var status = params.status || postData.status || 'vip_registered';
    
    var timestamp = Utilities.formatDate(new Date(), 'Africa/Lagos', 'yyyy-MM-dd HH:mm:ss') + ' WAT';

    if (name || email || phone) {
      sheet.appendRow([
        name,
        email,
        phone,
        timestamp,
        partner,
        redirectUrl,
        reference,
        status
      ]);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: 'logged', timestamp: timestamp }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}
