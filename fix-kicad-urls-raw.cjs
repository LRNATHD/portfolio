const fs = require('fs');
const path = require('path');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'node.js' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) { resolve(null); }
      });
    }).on('error', reject);
  });
}

async function fixUrls(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      await fixUrls(p);
    } else if (p.endsWith('.md')) {
      let content = fs.readFileSync(p, 'utf8');
      
      // Match either a tree url or a repo url
      const kicadMatch = content.match(/kicad:\s*\n\s*-\s*https:\/\/github\.com\/LRNATHD\/([^/\s]+)(?:\/tree\/main\/[^/\s]+)?/m);
      if (kicadMatch) {
        const repo = kicadMatch[1];
        console.log(`Checking repo ${repo}...`);
        const treeUrl = `https://api.github.com/repos/LRNATHD/${repo}/git/trees/main?recursive=1`;
        const treeData = await fetchJson(treeUrl);
        if (treeData && treeData.tree) {
          const pcbFile = treeData.tree.find(item => item.path.endsWith('.kicad_pcb'));
          if (pcbFile) {
            const rawUrl = `https://raw.githubusercontent.com/LRNATHD/${repo}/main/${pcbFile.path.replace(/\\/g, '/')}`;
            
            // replace whatever was there with the rawUrl
            const regex = new RegExp(`kicad:\\s*\\n\\s*-\\s*https:\\/\\/github\\.com\\/LRNATHD\\/${repo}[^\\n]*`, 'm');
            content = content.replace(regex, `kicad:\n  - ${rawUrl}`);
            fs.writeFileSync(p, content);
            console.log(`Updated ${p} to ${rawUrl}`);
          } else {
            console.log(`No .kicad_pcb found in ${repo}`);
          }
        }
      }
    }
  }
}

fixUrls('./src/content/pcbs').then(() => console.log('Done'));
