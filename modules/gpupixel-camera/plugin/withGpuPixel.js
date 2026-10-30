// Copies the GPUPixel v1.3.1 AAR (Apache-2.0) into android/app/libs and links it from app/build.gradle.
const fs = require('fs');
const path = require('path');
const { withDangerousMod, withAppBuildGradle } = require('expo/config-plugins');

const AAR = 'gpupixel-release.aar';
const LINE = `    implementation files('libs/${AAR}')`;

module.exports = function withGpuPixel(config) {
  config = withDangerousMod(config, ['android', (c) => {
    const libs = path.join(c.modRequest.platformProjectRoot, 'app', 'libs');
    fs.mkdirSync(libs, { recursive: true });
    fs.copyFileSync(path.join(__dirname, '..', 'android', 'libs', AAR), path.join(libs, AAR));
    return c;
  }]);
  return withAppBuildGradle(config, (c) => {
    if (!c.modResults.contents.includes(`libs/${AAR}`)) {
      c.modResults.contents = c.modResults.contents.replace(/dependencies\s*\{/, (m) => `${m}\n${LINE}`);
    }
    return c;
  });
};
