// root/scripts/build-extensions.js
const { execSync } = require('child_process')

/**
 * CONFIGURATION
 * Add new extensions to this array.
 * * name: A label for logging
 * command: The actual shell command to run
 */
const extensionTasks = [
  {
    name: 'cedar-template-converter',
    command: 'yarn workspace cedar-template-converter build',
  },
  {
    name: 'file-preview',
    command: 'yarn workspace file-preview build',
  },
  {
    name: 'metadata-schema-manager',
    command: 'yarn workspace metadata-schema-manager build',
  },
  {
    name: 'file-explorer',
    command: 'yarn workspace file-explorer build',
  },
  // Future example:
  // { name: 'new-extension', command: 'yarn workspace new-extension build' }
]

console.log('--- 📦 Starting Extensions Build ---')

try {
  extensionTasks.forEach((task) => {
    console.log(`\n> Building: ${task.name}...`)

    // stdio: 'inherit' ensures you see the colors and output
    // from the yarn command in your terminal
    execSync(task.command, { stdio: 'inherit' })

    console.log(`✓ ${task.name} built successfully.`)
  })

  console.log('\n--- ✅ All extensions built successfully ---')
} catch (error) {
  console.error('\n--- ❌ Build failed! Stopping process. ---')
  // Exit with error code 1 so the chain in package.json stops
  process.exit(1)
}
