const fs = require('fs');
const path = require('path');

function walk(dir) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith('.md')) {
      let content = fs.readFileSync(p, 'utf8');
      
      const idMatch = content.match(/^id:\s*(.+)$/m);
      if (idMatch) {
        const id = idMatch[1].trim();
        // Check if title is empty
        const titleMatch = content.match(/^title:(\s*)$/m);
        if (titleMatch) {
          // generate a title from the id
          const parts = id.split('-');
          const title = parts.map(p => {
             if (p.toLowerCase() === 'ch572d') return 'CH572D';
             if (p.toLowerCase() === 'ch32m030') return 'CH32M030';
             if (p.toLowerCase() === 'ch592x') return 'CH592X';
             if (p.toLowerCase() === 'ch339w') return 'CH339W';
             if (p.toLowerCase() === 'ch32x035') return 'CH32X035';
             return p.charAt(0).toUpperCase() + p.slice(1);
          }).join(' ');
          
          content = content.replace(/^title:(\s*)$/m, 'title: ' + title);
          fs.writeFileSync(p, content);
          console.log('Fixed title for ' + p + ' -> ' + title);
        }
      }
    }
  }
}

walk('./src/content/pcbs');
