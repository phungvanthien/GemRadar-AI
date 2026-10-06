const { execSync } = require('child_process');
try {
  const out = execSync('npm run build');
  console.log('BUILD SUCCESS');
} catch (err) {
  console.log('BUILD FAILED');
  console.log(err.stdout.toString());
  console.log(err.stderr.toString());
}
