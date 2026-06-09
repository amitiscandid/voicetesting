const fs = require('fs');
const path = require('path');

function patchFile(filePath, replacements) {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    for (const r of replacements) {
      if (r.pattern.test(content)) {
        content = content.replace(r.pattern, r.replacement);
        modified = true;
      }
    }
    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Successfully patched: ${filePath}`);
    } else {
      console.log(`Already patched or no match in: ${filePath}`);
    }
  } else {
    console.log(`File not found: ${filePath}`);
  }
}

// 1. Patch react-native-tts build.gradle
const ttsPath = path.join(__dirname, 'node_modules', 'react-native-tts', 'android', 'build.gradle');
patchFile(ttsPath, [
  { pattern: /jcenter\(\)/g, replacement: 'google()\n        mavenCentral()' },
  { pattern: /'com.android.tools.build:gradle:1.3.1'/g, replacement: "'com.android.tools.build:gradle:8.2.1'" },
  { pattern: /android\s*{/g, replacement: 'android {\n    namespace "net.no_mad.tts"' }
]);

// 2. Patch @react-native-voice/voice build.gradle
const voicePath = path.join(__dirname, 'node_modules', '@react-native-voice', 'voice', 'android', 'build.gradle');
patchFile(voicePath, [
  { pattern: /jcenter\(\)/g, replacement: 'google()\n        mavenCentral()' },
  { pattern: /'com.android.tools.build:gradle:3.3.2'/g, replacement: "'com.android.tools.build:gradle:8.2.1'" },
  { pattern: /android\s*{/g, replacement: 'android {\n    namespace "com.wenkesj.voice"' },
  { pattern: /"com.android.support:appcompat-v7:\${supportVersion}"/g, replacement: '"androidx.appcompat:appcompat:1.6.1"' }
]);
