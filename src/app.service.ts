/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly basePath = '/home/camilo/code/robot-framework-test';
  private readonly logsPath = path.join(this.basePath, 'logs');
  private readonly outputFilePath = path.join(
    this.logsPath,
    'robot_output.json',
  );
  private readonly testsPath = path.join(this.basePath, 'tests');
  private readonly pythonPath = path.join(this.basePath, 'venv/bin/python');

  getHello(): string {
    return 'Hello World!';
  }

  async executeRobotTest(
    url: string,
  ): Promise<{ success: boolean; output: string; stats?: any }> {
    const command = `${this.pythonPath} -m robot --variable "URL:${url}" --outputdir ${this.logsPath} --loglevel DEBUG --output ${this.outputFilePath} ${this.testsPath}`;

    this.logger.log(`Ejecutando comando: ${command}`);

    try {
      const { stdout, stderr } = await this.execCommand(command);
      this.logger.log(`stdout: ${stdout}`);
      if (stderr) this.logger.warn(`stderr: ${stderr}`);

      const stats = await this.readAndParseOutput();
      return { success: stats.total.pass > 0, output: stdout, stats };
    } catch (error) {
      this.logger.error('Error ejecutando prueba Robot:', error);
      throw new InternalServerErrorException('Error ejecutando prueba Robot');
    }
  }

  private execCommand(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          return reject(
            new InternalServerErrorException(
              `Error en ejecución: ${error.message}`,
            ),
          );
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private async readAndParseOutput(): Promise<any> {
    try {
      await fs.access(this.outputFilePath);
      const data = await fs.readFile(this.outputFilePath, 'utf8');
      const jsonData = JSON.parse(data);

      if (!jsonData.statistics) {
        throw new BadRequestException(
          'El JSON no contiene estadísticas válidas.',
        );
      }

      return jsonData.statistics;
    } catch (error) {
      this.logger.error('Error leyendo o procesando el JSON:', error);
      throw new InternalServerErrorException(
        'Error procesando el resultado de la prueba',
      );
    }
  }
}
