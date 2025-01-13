import inquirer from "inquirer";

interface Choices {
  name: string;
  value: 'quit' | 'process';
}

const displayMainMenu = async () => {
  const choices: Choices[] = [
    { name: 'Process the folder', value: 'process' },
    { name: 'Quit app', value: 'quit' },
  ];

  const { action } = await inquirer.prompt<{ action: Choices['value'] }>([
    {
      type: 'list',
      name: 'action',
      message: 'Select an option:',
      choices,
    },
  ]);

  return action;
};

interface PauseMenuChoices {
  name: string;
  value: 'resume' | 'stop';
}

const displayPauseMenu = async () => {
  const choices: PauseMenuChoices[] = [
    { name: 'Resume processing', value: 'resume' },
    { name: 'Stop and return to main menu', value: 'stop' },
  ];

  const { action } = await inquirer.prompt<{ action: PauseMenuChoices['value'] }>([
    {
      type: 'list',
      name: 'action',
      message: 'Select an option:',
      choices,
    },
  ]);

  return action;
}

export { displayMainMenu, displayPauseMenu };
