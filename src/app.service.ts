import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as xml2js from 'xml2js';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  private readonly basePath =
    process.env.ROBOT_PATH ?? '/home/opc/dian_automatization/robot';
  private readonly logsPath = path.join(this.basePath, 'logs');
  private readonly outputXmlPath = path.join(this.logsPath, 'output.xml');
  private readonly testsPath = path.join(this.basePath, 'tests');
  private lastStdout: string = '';

  getHello(): string {
    return 'Hello World!';
  }

  async executeRobotTest(
    url: string,
  ): Promise<{ success: boolean; output: string; stats?: any; errorMessage?: string }> {
    const dockerCommand = `docker run --rm \
      --user $(id -u):$(id -g) \
      --network=host \
      -v ${this.basePath}/logs:/opt/robotframework/results:Z \
      -v ${this.basePath}/tests:/opt/robotframework/tests:Z \
      -v ${this.basePath}/resources:/opt/robotframework/resources:Z \
      -v ${this.basePath}/libs:/opt/robotframework/libs:Z \
      -e 'ROBOT_OPTIONS=--variable URL:${url} --outputdir /opt/robotframework/results --loglevel DEBUG' \
      ppodgorsek/robot-framework`;

    this.logger.log(`Ejecutando comando Docker: ${dockerCommand}`);

    try {
      const { stdout, stderr } = await this.execCommand(dockerCommand);
      this.logger.log(`stdout: ${stdout}`);
      if (stderr) this.logger.warn(`stderr: ${stderr}`);

      // Store stdout for possible fallback parsing
      this.lastStdout = stdout;

      // Parse the output.xml file
      let stats;
      try {
        stats = await this.parseRobotOutputXml();
      } catch (error) {
        this.logger.warn(`Error parsing XML: ${error.message}`);
        stats = { pass: 0, fail: 0, skip: 0 };
      }
      
      // If XML parsing failed, try parsing from stdout
      if (stats.pass === 0 && stats.fail === 0 && stats.skip === 0) {
        const stdoutStats = this.parseStatsFromStdout(stdout);
        if (stdoutStats.pass > 0 || stdoutStats.fail > 0) {
          Object.assign(stats, stdoutStats);
        }
      }
      
      // Check if tests passed or failed based on stats
      const success = stats.pass > 0 && stats.fail === 0;
      
      // If tests failed but we don't have an error message, try to extract it
      if (!success && !stats.errorMessage) {
        stats.errorMessage = this.extractErrorMessageFromStdout(stdout);
      }

      // Si hay errores en las pruebas pero aún así se completaron, lanzar HTTP 424
      if (!success && stats.fail > 0) {
        throw new HttpException(
          { 
            success: false, 
            output: stdout, 
            stats, 
            errorMessage: stats.errorMessage 
          }, 
          424
        );
      }
      
      return { 
        success, 
        output: stdout, 
        stats,
        errorMessage: success ? undefined : stats.errorMessage 
      };
    } catch (error) {
      // Si ya es un HttpException, lo propagamos
      if (error instanceof HttpException) {
        throw error;
      }

      // Si el comando falló completamente, retornamos stats null
      this.logger.error('Error ejecutando prueba Robot en Docker:', error);
      throw new InternalServerErrorException({
        success: false,
        output: this.lastStdout || error.message,
        stats: null,
        errorMessage: `Error ejecutando prueba Robot: ${error.message}`
      });
    }
  }

  private execCommand(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      exec(command, (error, stdout, stderr) => {
        if (error) {
          this.logger.error(`Error en ejecución de comando: ${error.message}`);
          this.logger.error(`stdout: ${stdout}`);
          this.logger.error(`stderr: ${stderr}`);
          
          // En lugar de rechazar con excepción, resolvemos con lo que tenemos
          // para poder procesar mejor el error
          return resolve({ 
            stdout: stdout || `Error: ${error.message}`, 
            stderr 
          });
        }
        resolve({ stdout, stderr });
      });
    });
  }

  private async parseRobotOutputXml(): Promise<{ pass: number; fail: number; skip: number; errorMessage?: string }> {
    try {
      await fs.access(this.outputXmlPath);
      const xmlData = await fs.readFile(this.outputXmlPath, 'utf8');
      
      // Log the first 500 characters of the XML
      this.logger.debug(`XML sample: ${xmlData.substring(0, 500)}...`);
      
      const parser = new xml2js.Parser({ explicitArray: true });
      const result = await parser.parseStringPromise(xmlData);
      
      // Check if we have valid statistics
      if (!result.robot || !result.robot.statistics || !result.robot.statistics[0] || !result.robot.statistics[0].total) {
        throw new BadRequestException('El XML no contiene estadísticas válidas.');
      }
      
      // Extract statistics
      const totalStats = result.robot.statistics[0].total[0].stat;
      let pass = 0, fail = 0, skip = 0;
      
      // Find the "All Tests" stat
      for (const stat of totalStats) {
        if (stat.$.name === 'All Tests') {
          pass = parseInt(stat.$.pass, 10) || 0;
          fail = parseInt(stat.$.fail, 10) || 0;
          skip = parseInt(stat.$.skip, 10) || 0;
          break;
        }
      }
      
      // Extract error message if test failed
      let errorMessage;
      if (fail > 0 && result.robot.suite) {
        errorMessage = this.extractErrorMessage(result.robot);
      }
      
      return { pass, fail, skip, errorMessage };
    } catch (error) {
      this.logger.error('Error leyendo o procesando el XML:', error);
      throw new BadRequestException('Error procesando el resultado de la prueba');
    }
  }
  
  private parseStatsFromStdout(stdout: string): { pass: number; fail: number; skip: number } {
    try {
      // Look for lines with test summary like "1 test, 1 passed, 0 failed"
      const summaryRegex = /(\d+) test, (\d+) passed, (\d+) failed/;
      const matches = summaryRegex.exec(stdout);
      
      if (matches && matches.length >= 4) {
        const total = parseInt(matches[1], 10) || 0;
        const pass = parseInt(matches[2], 10) || 0;
        const fail = parseInt(matches[3], 10) || 0;
        const skip = total - (pass + fail);
        
        return { pass, fail, skip };
      }
      
      
      const passCount = (stdout.match(/\| PASS \|/g) || []).length;
      const failCount = (stdout.match(/\| FAIL \|/g) || []).length;
      
      if (passCount > 0 || failCount > 0) {
        return { 
          pass: passCount, 
          fail: failCount, 
          skip: 0 
        };
      }
      
      return { pass: 0, fail: 0, skip: 0 };
    } catch (error) {
      this.logger.warn('Error parsing stats from stdout:', error);
      return { pass: 0, fail: 0, skip: 0 };
    }
  }
  
  private extractErrorMessageFromStdout(stdout: string): string | undefined {
    try {
      // Try to find a block of text between FAIL and the next separator
      const failureRegex = /\| FAIL \|\s*\n(.*?)(?=\n-{10,}|\n={10,}|$)/s;
      const matches = failureRegex.exec(stdout);
      
      if (matches && matches.length >= 2) {
        return matches[1].trim();
      }
      
      // Check for specific error message
      const errorRegex = /Element with locator .* not found/;
      const errorMatch = errorRegex.exec(stdout);
      if (errorMatch) {
        return errorMatch[0];
      }
      
      return undefined;
    } catch (error) {
      this.logger.warn('Error extracting error message from stdout:', error);
      return undefined;
    }
  }
  
  private extractErrorMessage(robot: any): string | undefined {
    try {
      // Navigate through the XML structure to find test failures
      if (!robot.suite || !robot.suite[0]) {
        return undefined;
      }
      
      const errorMessages: string[] = [];
      this.traverseSuites(robot.suite[0], errorMessages);
      
      return errorMessages.length > 0 ? errorMessages[0] : undefined;
    } catch (error) {
      this.logger.warn('Error extracting failure message from XML:', error);
      return undefined;
    }
  }
  
  private traverseSuites(suiteNode: any, errorMessages: string[]): void {
    
    if (suiteNode.test) {
      for (const test of suiteNode.test) {
        if (test.status && test.status[0] && test.status[0].$.status === 'FAIL') {
          if (test.status[0]._) {
            errorMessages.push(test.status[0]._);
          }
        }
        
        // Check keywords in tests
        if (test.kw) {
          this.traverseKeywords(test.kw, errorMessages);
        }
      }
    }
    
    // Check nested suites
    if (suiteNode.suite) {
      for (const suite of suiteNode.suite) {
        this.traverseSuites(suite, errorMessages);
      }
    }
  }
  
  private traverseKeywords(keywords: any[], errorMessages: string[]): void {
    if (!keywords || !keywords.length) return;
    
    for (const kw of keywords) {
      // Check for keyword failures
      if (kw.status && kw.status[0] && kw.status[0].$.status === 'FAIL') {
        if (kw.status[0]._) {
          errorMessages.push(kw.status[0]._);
        }
      }
      
      
      if (kw.kw) {
        this.traverseKeywords(kw.kw, errorMessages);
      }
    }
  }
}