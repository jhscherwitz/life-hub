// Turns on real code signing for this CI build when the signing secrets exist.
// Without them, package.json's defaults stay: an ad-hoc signed Mac app and an unsigned Windows installer.
import fs from 'node:fs';

const env = process.env;
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const { mac, win } = pkg.build;

if (process.platform === 'darwin' && env.CSC_LINK) {
  // Sign with the Developer ID certificate in CSC_LINK, using the hardened runtime
  // that notarization requires. Notarization runs when APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD
  // and APPLE_TEAM_ID are set.
  delete mac.identity;
  delete mac.hardenedRuntime;
  console.log('Mac: signing with the Developer ID certificate.');
} else if (process.platform === 'darwin') {
  console.log('Mac: no CSC_LINK secret, so the app is ad-hoc signed only.');
}

if (process.platform === 'win32' && env.AZURE_CLIENT_SECRET) {
  const required = ['AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_CERT_PROFILE', 'AZURE_PUBLISHER_NAME'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Windows signing needs these repository variables too: ${missing.join(', ')}`);
  win.azureSignOptions = {
    endpoint: env.AZURE_SIGNING_ENDPOINT,
    codeSigningAccountName: env.AZURE_SIGNING_ACCOUNT,
    certificateProfileName: env.AZURE_CERT_PROFILE,
    publisherName: env.AZURE_PUBLISHER_NAME,
  };
  console.log('Windows: signing with Azure Artifact Signing.');
} else if (process.platform === 'win32') {
  console.log('Windows: no AZURE_CLIENT_SECRET secret, so the installer is unsigned.');
}

fs.writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
