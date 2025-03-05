import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  executeRobotTest(url: string): Promise<{ success: boolean; output: string }> {
    return new Promise((resolve) => {
      const command = `/home/camilo/code/robot-framework-test/venv/bin/python -m robot --variable "URL:${url}" /home/camilo/code/robot-framework-test/tests/`;

      console.log(command);
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${stderr}`);
          return resolve({ success: false, output: stderr });
        }
        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);
        return resolve({ success: true, output: stdout });
      });
    });
  }
}
