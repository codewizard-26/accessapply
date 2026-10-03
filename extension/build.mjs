import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const extensionRoot = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(extensionRoot, '..')
const outputDirectory = join(extensionRoot, 'dist')

for (const app of ['profile-ui', 'accessibility-ui']) {
  execSync(process.platform === 'win32' ? 'npm.cmd run build' : 'npm run build', {
    cwd: join(repositoryRoot, app),
    stdio: 'inherit',
  })
}

rmSync(outputDirectory, { recursive: true, force: true })
mkdirSync(outputDirectory, { recursive: true })
cpSync(join(extensionRoot, 'manifest.json'), join(outputDirectory, 'manifest.json'))
cpSync(join(extensionRoot, 'src', 'launcher'), join(outputDirectory, 'launcher'), { recursive: true })
cpSync(join(repositoryRoot, 'shared', 'profile'), join(outputDirectory, 'shared', 'profile'), { recursive: true })
cpSync(join(repositoryRoot, 'shared', 'styles'), join(outputDirectory, 'shared', 'styles'), { recursive: true })

for (const app of ['profile-ui', 'accessibility-ui']) {
  cpSync(join(repositoryRoot, app, 'dist'), join(outputDirectory, app), { recursive: true })
}

console.log(`Extension built at ${outputDirectory}`)
