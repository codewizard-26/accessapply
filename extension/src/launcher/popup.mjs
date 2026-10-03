import { getExtensionPageUrl, getStartupDestination } from '../shared/profile/profileStorage.mjs'

const status = document.querySelector('#launcher-status')
const error = document.querySelector('#launcher-error')
const retry = document.querySelector('#retry')

async function openWorkspace() {
  retry.hidden = true
  error.hidden = true
  status.textContent = 'Checking your saved profile…'

  try {
    const destination = await getStartupDestination()
    window.location.replace(getExtensionPageUrl(destination))
  } catch (reason) {
    status.textContent = 'AccessApply could not open your workspace.'
    error.textContent = reason instanceof Error ? reason.message : 'An unexpected error occurred. Please try again.'
    error.hidden = false
    retry.hidden = false
  }
}

retry.addEventListener('click', () => {
  void openWorkspace()
})

void openWorkspace()
