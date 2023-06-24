

function overlay(elem, data) {
  window.onload = function () {
    const bodyElement = document.body
    const overlayElement = document.createElement('div')
    overlayElement.setAttribute('class', 'in4-overlay')
    bodyElement.appendChild(overlayElement)

    const rect = elem.getBoundingClientRect()

    let count = 1
    for (const item of data) {
      const left = rect.width * item.x / 100 + rect.x
      const top = rect.height * item.y / 100 + rect.y

      const popover = `desc-${count}`

      const descElem = document.createElement('div')
      descElem.setAttribute('class', 'in4-overlay-description')
      descElem.setAttribute('popover', 'auto')
      descElem.setAttribute('id', popover)
      descElem.innerText = item.description
      overlayElement.appendChild(descElem)

      const element = document.createElement('div')
      element.setAttribute('class', 'in4-overlay-item')
      element.setAttribute('style', `top: ${top}px; left: ${left}px`)
      element.setAttribute('popovertarget', popover)
      element.addEventListener('mouseover', (e) => {
        if (!descElem.matches(':popover-open')) {
          descElem.showPopover()
        }
      })
      bodyElement.appendChild(element)
      count++
    }
  }
}
