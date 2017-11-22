const buttonText = {
  //"string that has to be included in Watson output text" : button array index in buttons defined below.
  "Posso ajudar": 0,
  "posso ajudar": 0,
  "posso ajudá-lo": 0,
  "alguma dúvida": 0,

  "assistência para automóveis ou para casa": 1,

  "assistência residencial ou veicular": 2,

  "equipamentos ou seguro de viagem": 3,
  "Equipamentos ou viagem": 3,
  "equipamentos ou viagem": 3,
}
const buttons = [
  ['Sim', 'Não'],
  ['Assistência', 'Seguro', 'Sala VIP'], 
  ['Residencial', 'Veicular'],
  ['Equipamentos', 'Viagem'],
//  ['Adresse', 'Identité', 'Offre', 'Options TV', 'Moyen de paiement'],
//  ['Canal+', 'CanalSat', 'Les deux', 'Aucun']
]
module.exports = {
  /**
   * Returns button array if necessary.
   * The rules to react are set in the static arrays buttonText and buttons.
   * @param   {string}               text    text from Watson
   * @return  {Object or boolean}            buttons or false if not needed
   */
  sendWithButtons: function(text) {
    if (Object.keys(buttonText).length !== 0) {
      for (button in buttonText) {
        if (text.indexOf(button) !== -1) return buttons[buttonText[button]];
      }
    }
    return false;
  }
}
