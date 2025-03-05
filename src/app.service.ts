/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-misused-promises */
import { Injectable } from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }

  async executeRobotTest(
    url: string,
  ): Promise<{ success: boolean; output: string; stats?: any }> {
    return new Promise((resolve) => {
      const logsPath = '/home/camilo/code/robot-framework-test/logs';
      const outputFilePath = path.join(logsPath, 'robot_output.json');

      const command = `/home/camilo/code/robot-framework-test/venv/bin/python -m robot --variable "URL:${url}" --outputdir ${logsPath} --loglevel DEBUG --output ${outputFilePath} /home/camilo/code/robot-framework-test/tests/`;

      console.log(`Ejecutando comando: ${command}`);

      exec(command, async (error, stdout, stderr) => {
        if (error) {
          console.error(`Error en ejecución: ${stderr}`);
          return resolve({ success: false, output: stderr });
        }

        console.log(`stdout: ${stdout}`);
        console.error(`stderr: ${stderr}`);

        try {
          // Verificar si el archivo de salida existe
          await fs.access(outputFilePath);

          // Leer y parsear el JSON
          const data = await fs.readFile(outputFilePath, 'utf8');
          const jsonData = JSON.parse(data);

          if (!jsonData.statistics) {
            throw new Error('El JSON no contiene estadísticas válidas.');
          }

          console.log('Statistics:', jsonData.statistics);

          return resolve({
            success: true,
            output: stdout,
            stats: jsonData.statistics,
          });
        } catch (fileError) {
          console.error(`Error leyendo o procesando el JSON: ${fileError}`);
          return resolve({ success: true, output: stdout, stats: null });
        }
      });
    });
  }
}
